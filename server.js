const http = require("node:http");
const { randomUUID } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const QRCode = require("qrcode");

try {
  const envFile = readFileSync(path.join(__dirname, ".env"), "utf8");
  for (const line of envFile.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1] in process.env) {
      continue;
    }

    const value = match[2];
    process.env[match[1]] =
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
        ? value.slice(1, -1)
        : value;
  }
} catch (error) {
  if (error.code !== "ENOENT") {
    throw error;
  }
}

const port = Number(process.env.PORT || 3000);
const publicDirectory = path.join(__dirname, "public");
const maxRequestBytes = 10 * 1024;
const allowedStaticFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/paid", ["paid.html", "text/html; charset=utf-8"]],
  ["/paid/", ["paid.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/paid.js", ["paid.js", "text/javascript; charset=utf-8"]],
]);
function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(data));
}

async function readJsonBody(request) {
  if (request.body !== undefined) {
    const body = request.body;
    const serializedBody = Buffer.isBuffer(body) ? body.toString("utf8") : body;
    const bodyText =
      typeof serializedBody === "string" ? serializedBody : JSON.stringify(serializedBody);
    if (Buffer.byteLength(bodyText) > maxRequestBytes) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }

    if (typeof serializedBody !== "string") {
      return serializedBody;
    }

    try {
      return JSON.parse(serializedBody);
    } catch {
      const error = new Error("Request body must be valid JSON.");
      error.statusCode = 400;
      throw error;
    }
  }

  let body = "";

  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > maxRequestBytes) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
  }

  try {
    return JSON.parse(body);
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    throw error;
  }
}

function getPaymentConfiguration() {
  const apiBaseUrl = process.env.KIZOPAY_API_BASE_URL;
  const apiKey = process.env.KIZOPAY_API_KEY;
  const merchantCode = process.env.KIZOPAY_MERCHANT_CODE;

  if (!apiBaseUrl || !apiKey || !merchantCode) {
    const error = new Error(
      "Payment service is not configured. Set KIZOPAY_API_BASE_URL, KIZOPAY_API_KEY, and KIZOPAY_MERCHANT_CODE."
    );
    error.statusCode = 503;
    throw error;
  }

  let parsedBaseUrl;
  try {
    parsedBaseUrl = new URL(apiBaseUrl);
  } catch {
    const error = new Error("KIZOPAY_API_BASE_URL must be a valid URL.");
    error.statusCode = 503;
    throw error;
  }

  if (
    parsedBaseUrl.protocol !== "https:" &&
    !(parsedBaseUrl.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsedBaseUrl.hostname))
  ) {
    const error = new Error("KIZOPAY_API_BASE_URL must use HTTPS.");
    error.statusCode = 503;
    throw error;
  }

  return {
    apiBaseUrl: parsedBaseUrl.toString().replace(/\/+$/, ""),
    apiKey,
    merchantCode,
  };
}

function getCheckoutReturnUrl(request, paymentStatus) {
  const host = request.headers["x-forwarded-host"] || request.headers.host;
  const forwardedProtocol = request.headers["x-forwarded-proto"];
  const protocol = forwardedProtocol
    ? forwardedProtocol.split(",")[0].trim()
    : request.socket.encrypted
      ? "https"
      : "http";

  if (!host || !["http", "https"].includes(protocol)) {
    const error = new Error("Could not determine the checkout return URL.");
    error.statusCode = 400;
    throw error;
  }

  const hostName = host.split(",")[0].trim();
  const returnUrl = new URL("/", `${protocol}://${hostName}`);
  returnUrl.searchParams.set("payment", paymentStatus);
  return returnUrl.toString();
}

async function callKizoPay(pathname, options = {}) {
  const { apiBaseUrl, apiKey } = getPaymentConfiguration();
  const response = await fetch(`${apiBaseUrl}${pathname}`, {
    ...options,
    headers: {
      "X-API-Key": apiKey,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(15000),
  });

  const responseText = await response.text();
  let data;
  try {
    data = responseText ? JSON.parse(responseText) : null;
  } catch {
    const contentType = response.headers.get("content-type") || "missing Content-Type";
    if (!response.ok) {
      const error = new Error(
        `KizoPay rejected the request (HTTP ${response.status}).${response.status === 401 || response.status === 403 ? " Check that KIZOPAY_API_KEY in .env is correct and restart the app." : ""}`
      );
      error.statusCode = response.status >= 400 && response.status < 500 ? response.status : 502;
      throw error;
    }

    const error = new Error(
      `KizoPay endpoint ${pathname} returned a non-JSON response (HTTP ${response.status}, ${contentType}).`
    );
    error.code = "KIZOPAY_NON_JSON";
    error.statusCode = 502;
    throw error;
  }

  if (!response.ok) {
    const error = new Error(
      data && typeof data === "object" && typeof data.message === "string"
        ? data.message
        : data && typeof data === "object" && typeof data.error === "string"
          ? data.error
          : `KizoPay rejected the request (HTTP ${response.status}).${response.status === 401 || response.status === 403 ? " Check that KIZOPAY_API_KEY in .env is correct and restart the app." : ""}`
    );
    error.statusCode = response.status >= 400 && response.status < 500 ? response.status : 502;
    throw error;
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    const error = new Error(`KizoPay returned an unexpected JSON response (HTTP ${response.status}).`);
    error.statusCode = 502;
    throw error;
  }

  return data;
}

function normalizeAmount(value) {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(value.trim())) {
    return null;
  }

  const amount = value.trim();
  const [whole, fraction = ""] = amount.split(".");
  const cents = BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
  if (cents <= 0n) {
    return null;
  }

  return `${whole}.${(fraction + "00").slice(0, 2)}`;
}

async function handleApiRequest(request, response, pathname) {
  if (request.method === "POST" && pathname === "/api/payments") {
    const body = await readJsonBody(request);
    const amount = normalizeAmount(
      body && typeof body === "object" && !Array.isArray(body) ? body.amount : null
    );

    if (!amount) {
      return sendJson(response, 400, {
        error: "Enter an amount greater than zero with no more than two decimal places.",
      });
    }

    const { apiBaseUrl, merchantCode } = getPaymentConfiguration();
    const orderId = randomUUID();
    const payment = await callKizoPay("/api/v1/payment/create", {
      method: "POST",
      body: JSON.stringify({
        code_merchant: merchantCode,
        amount,
        currency: "USD",
        continue_url: getCheckoutReturnUrl(request, "SUCCESS"),
        cancel_url: getCheckoutReturnUrl(request, "CANCELLED"),
      }),
    });

    if (payment.invoice_id === undefined || payment.invoice_id === null) {
      throw new Error("KizoPay did not return an invoice ID.");
    }

    const invoiceId = String(payment.invoice_id);

    return sendJson(response, 200, {
      invoice_id: invoiceId,
      order_id: orderId,
      payment_status: payment.payment_status,
      qr_url: `${apiBaseUrl}/api/v1/payment/qr-code/verify/${encodeURIComponent(invoiceId)}`,
    });
  }

  const orderMatch = pathname.match(/^\/api\/orders\/([^/]+)$/);
  if (request.method === "GET" && orderMatch) {
    let invoiceId;
    try {
      invoiceId = decodeURIComponent(orderMatch[1]);
    } catch {
      return sendJson(response, 400, { error: "Invalid invoice ID." });
    }

    if (!/^[A-Za-z0-9_-]+$/.test(invoiceId)) {
      return sendJson(response, 400, { error: "Invalid invoice ID." });
    }

    const result = await callKizoPay(`/api/v1/payment/verify/${encodeURIComponent(invoiceId)}`);
    return sendJson(response, 200, {
      invoice_id: invoiceId,
      amount:
        result.amount ??
        result.amount_usd ??
        result.total_amount ??
        null,
      currency: result.currency ?? "USD",
      status: result.payment_status ?? result.status ?? "UNKNOWN",
      ...(typeof result.receipt === "string" ? { receipt: result.receipt } : {}),
    });
  }

  const qrMatch = pathname.match(/^\/api\/payments\/([^/]+)\/qr$/);
  if (request.method === "GET" && qrMatch) {
    const invoiceId = encodeURIComponent(qrMatch[1]);
    let result;

    try {
      result = await callKizoPay(`/api/v1/payment/qr-code/verify/${invoiceId}`);
    } catch (error) {
      if (error.code !== "KIZOPAY_NON_JSON") {
        throw error;
      }

      result = await callKizoPay(`/api/v1/payment/verify/${invoiceId}`);
    }

    const qrImage =
      typeof result.qr_image === "string" && result.qr_image.startsWith("data:image/")
        ? result.qr_image
        : typeof result.khqr === "string" && result.khqr.length > 0
          ? await QRCode.toDataURL(result.khqr, {
              errorCorrectionLevel: "M",
              margin: 2,
              width: 320,
            })
          : undefined;

    return sendJson(response, 200, {
      ...result,
      ...(qrImage ? { qr_image: qrImage } : {}),
    });
  }

  const verifyMatch = pathname.match(/^\/api\/payments\/([^/]+)\/verify$/);
  if (request.method === "GET" && verifyMatch) {
    const invoiceId = encodeURIComponent(verifyMatch[1]);
    const result = await callKizoPay(`/api/v1/payment/verify/${invoiceId}`);
    return sendJson(response, 200, {
      ...result,
      status: result.status ?? result.payment_status ?? "UNKNOWN",
    });
  }

  return sendJson(response, 404, { error: "Not found." });
}

async function handleApi(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  try {
    await handleApiRequest(request, response, url.pathname);
  } catch (error) {
    const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 502;
    if (statusCode >= 500) {
      console.error("Payment request failed:", error.message);
    }
    sendJson(response, statusCode, { error: error.message || "Payment request failed." });
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response);
      return;
    }

    const orderMatch = url.pathname.match(/^\/order\/([A-Za-z0-9_-]+)$/);
    const staticFile =
      allowedStaticFiles.get(url.pathname) ||
      (orderMatch ? ["paid.html", "text/html; charset=utf-8"] : null);
    if (request.method !== "GET" || !staticFile) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    const content = await readFile(path.join(publicDirectory, staticFile[0]));
    response.writeHead(200, {
      "Content-Type": staticFile[1],
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
    });
    response.end(content);
  } catch (error) {
    const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 502;
    if (statusCode >= 500) {
      console.error("Payment request failed:", error.message);
    }
    sendJson(response, statusCode, { error: error.message || "Payment request failed." });
  }
});

module.exports = handleApi;

if (require.main === module) {
  server.listen(port, () => {
    console.log(`KizoPay checkout is listening on port ${port}.`);
  });
}
