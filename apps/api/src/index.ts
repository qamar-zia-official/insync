import { Hono } from "hono";
import verifyWebhook from "@repo/integrations/utils/shopify/shopify-webhook-verification";
import z from "zod";

const app = new Hono();

const SHOPIFY_WEBHOOK_SECRET = "";

app.post("/webhook/order", async (c) => {
  const RawBody = await c.req.text();
  const body = JSON.parse(RawBody);
  console.log("Raw Body: ", RawBody);
  console.log(c.req.header("X-Shopify-Topic"));
  const hmacHeader = c.req.header("X-Shopify-Hmac-SHA256");
  if (!hmacHeader) {
    console.log("No Hmac header found");
    return c.json(
      {
        success: false,
        message: "Hmac header did not find",
      },
      401,
    );
  }
  const isValid = await verifyWebhook(
    SHOPIFY_WEBHOOK_SECRET,
    RawBody,
    hmacHeader,
  );
  if (isValid) {
    console.log("\n\n\n Valid super valid");
    return c.json(
      {
        success: true,
        message: "webhook recieved successfully",
      },
      200,
    );
  }

  return c.json(
    {
      success: false,
      message: "Your signature did not match. Access denied",
    },
    401,
  );
});
export default app;
