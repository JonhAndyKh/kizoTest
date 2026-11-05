# KizoPay Checkout

A standalone Node.js checkout page that creates KizoPay USD invoices and displays their payment QR codes.

## Configure

Open `.env` in the project folder and paste your **new** API key after `KIZOPAY_API_KEY=`:

```dotenv
KIZOPAY_API_BASE_URL=https://kizo-pay2.vercel.app
KIZOPAY_API_KEY=your_new_api_key
KIZOPAY_MERCHANT_CODE=kizo_store
```

The server creates a KizoPay invoice and returns its ID and payment URL. The order page loads the invoice ID, amount, and latest payment status from KizoPay. Provider returns go to the checkout homepage, while the open checkout page checks the invoice and navigates to `/order/{invoiceId}` when payment completes. Cancellations return to checkout with `payment=CANCELLED`. The checkout must be publicly reachable for KizoPay to redirect to it; `localhost` only works for local browsing, not provider redirects. Keep `.env` private; it is excluded from Git. Start the app from PowerShell in the project folder:

```powershell
cd C:\Users\ASUS\Desktop\Test
npm start
```

Open `http://localhost:3000`. Enter a positive USD amount with up to two decimal places and click **Pay now**. The app securely creates the invoice on the server, opens KizoPay's official `/api/v1/payment/qr-code/verify/{invoiceId}` URL in a new tab, and keeps the checkout homepage open to display the QR code and monitor status from that same endpoint. When the invoice succeeds, the payment tab opens `/order/{invoiceId}` and the checkout tab is focused. `PORT` is optional and defaults to `3000`.

## Deploy to Vercel

Import this project into Vercel with the project root as the Root Directory. Vercel serves the static files from `public/` and the API routes from `api/`; `vercel.json` routes `/paid` and `/order/{invoiceId}` to the order page. No build command is required.

Add these environment variables in the Vercel project settings for Production and Preview:

- `KIZOPAY_API_BASE_URL`
- `KIZOPAY_API_KEY`
- `KIZOPAY_MERCHANT_CODE`

Deploy the project, then use the deployment's public HTTPS URL as the checkout URL configured with KizoPay. The provider returns to the checkout homepage; the open checkout tab checks the invoice and then opens its order page. Do not rely on local `.env` files in Vercel—configure secrets in the Vercel dashboard.
