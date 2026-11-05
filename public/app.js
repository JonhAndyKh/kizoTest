const form = document.querySelector("#payment-form");
const amountInput = document.querySelector("#amount");
const payButton = document.querySelector("#pay-button");

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const responseText = await response.text();
  let data;
  try {
    data = responseText ? JSON.parse(responseText) : null;
  } catch {
    const requestId = response.headers.get("x-vercel-id");
    const requestDetails = requestId ? ` Request ID: ${requestId}.` : "";
    throw new Error(
      `The checkout server returned a non-JSON response (HTTP ${response.status}).${requestDetails} Check the Vercel function logs.`
    );
  }

  if (!response.ok) {
    throw new Error(
      data && typeof data.error === "string"
        ? data.error
        : "The payment request could not be completed."
    );
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("The checkout server returned an unexpected response.");
  }
  return data;
}

function showReturnedPaymentStatus() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("payment")) {
    return;
  }

  params.delete("payment");
  const cleanUrl = new URL(window.location.href);
  cleanUrl.search = params.toString();
  window.history.replaceState({}, "", cleanUrl);
}

showReturnedPaymentStatus();

function isFinalPaymentStatus(status) {
  return Boolean(status) && !["PENDING", "PROCESSING"].includes(status.toUpperCase());
}

async function watchPayment(invoiceId, paymentWindow) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    const payment = await requestJson(
      `/api/payments/${encodeURIComponent(invoiceId)}/verify`
    );

    if (!isFinalPaymentStatus(payment.status)) {
      continue;
    }

    const finalStatus = payment.status.toUpperCase();

    if (paymentWindow && !paymentWindow.closed) {
      const returnUrl = new URL(
        finalStatus === "SUCCESS" ? `/order/${encodeURIComponent(invoiceId)}` : "/",
        window.location.origin
      );
      returnUrl.searchParams.set("payment", finalStatus);
      try {
        paymentWindow.location.replace(returnUrl.toString());
      } catch {
        // The checkout tab still shows the result if the browser blocks navigation.
      }
    }
    payButton.disabled = false;
    payButton.textContent = "Pay now";
    if (finalStatus !== "SUCCESS") {
      window.alert(`Payment finished with status: ${finalStatus}.`);
    }

    return;
  }

  payButton.disabled = false;
  payButton.textContent = "Pay now";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  payButton.disabled = true;
  payButton.textContent = "Opening secure payment...";
  const paymentWindow = window.open("about:blank", "_blank");
  if (paymentWindow) {
    paymentWindow.opener = null;
  }

  try {
    const payment = await requestJson("/api/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: amountInput.value }),
    });

    if (typeof payment.qr_url !== "string") {
      throw new Error("The checkout server did not return the KizoPay QR URL.");
    }

    if (paymentWindow && !paymentWindow.closed) {
      paymentWindow.location.replace(payment.qr_url);
    } else {
      window.location.assign(payment.qr_url);
      return;
    }

    payButton.textContent = "Pay now";
    await watchPayment(payment.invoice_id, paymentWindow);
  } catch (error) {
    if (paymentWindow && !paymentWindow.closed) {
      paymentWindow.close();
    }
    payButton.disabled = false;
    payButton.textContent = "Pay now";
    window.alert(error.message);
  }
});
