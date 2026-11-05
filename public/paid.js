const pageTitle = document.querySelector("#page-title");
const paymentIntro = document.querySelector("#payment-intro");
const paymentEyebrow = document.querySelector("#payment-eyebrow");
const paymentIcon = document.querySelector("#payment-icon");
const invoiceIdLabel = document.querySelector("#invoice-id");
const invoiceAmount = document.querySelector("#invoice-amount");
const invoiceStatus = document.querySelector("#invoice-status");

async function loadOrder() {
  const invoiceId = window.location.pathname.split("/").filter(Boolean).at(-1);
  if (!invoiceId || !/^[A-Za-z0-9_-]+$/.test(invoiceId)) {
    showOrderError("This order link is invalid.");
    return;
  }

  invoiceIdLabel.textContent = invoiceId;

  try {
    const response = await fetch(`/api/orders/${encodeURIComponent(invoiceId)}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const order = await response.json();
    if (!response.ok) {
      throw new Error(order.error || "We couldn't load this order.");
    }

    const status = String(order.status || "UNKNOWN").toUpperCase();
    const isPaid = ["SUCCESS", "PAID", "COMPLETED"].includes(status);
    const isPending = ["PENDING", "PROCESSING"].includes(status);

    pageTitle.textContent = isPaid ? "Paid Successfully" : isPending ? "Payment processing" : "Payment details";
    paymentIntro.textContent = isPaid
      ? "Your payment has been received. Thank you for your order."
      : isPending
        ? "Your payment is still being confirmed. Please check back shortly."
        : "Here are the latest details available for this payment.";
    paymentEyebrow.textContent = isPaid ? "PAYMENT COMPLETE" : "ORDER DETAILS";
    paymentIcon.textContent = isPaid ? "✓" : isPending ? "…" : "i";
    paymentIcon.classList.toggle("pending-mark", isPending);
    paymentIcon.classList.toggle("neutral-mark", !isPaid && !isPending);
    invoiceIdLabel.textContent = order.invoice_id || invoiceId;
    invoiceStatus.textContent = status;
    invoiceStatus.classList.toggle("status-paid", isPaid);
    invoiceStatus.classList.toggle("status-pending", isPending);
    invoiceStatus.classList.toggle("status-other", !isPaid && !isPending);

    if (order.amount !== null && order.amount !== undefined && order.amount !== "") {
      const amount = Number(order.amount);
      invoiceAmount.textContent = Number.isFinite(amount)
        ? new Intl.NumberFormat(undefined, {
            style: "currency",
            currency: order.currency || "USD",
          }).format(amount)
        : `${order.amount} ${order.currency || "USD"}`;
    } else {
      invoiceAmount.textContent = "Not provided";
    }
    document.title = `${pageTitle.textContent} | KizoPay Checkout`;
  } catch (error) {
    showOrderError(error.message);
  }
}

function showOrderError(message) {
  pageTitle.textContent = "Order details unavailable";
  paymentIntro.textContent = message;
  paymentEyebrow.textContent = "ORDER LOOKUP";
  paymentIcon.textContent = "!";
  paymentIcon.classList.add("neutral-mark");
  invoiceStatus.textContent = "UNAVAILABLE";
  invoiceStatus.classList.add("status-other");
}

loadOrder();
