export default async function verifyWebhook(
  key: string,
  rawReq: string,
  hmacHeader: string,
): Promise<boolean> {
  console.log("HMAC Header", hmacHeader);

  const encoder = new TextEncoder();

  const secreteKeyData = encoder.encode(key);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    secreteKeyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const encodedRawBody = encoder.encode(rawReq);

  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    encodedRawBody,
  );

  const generatedHMACBase64 = btoa(
    String.fromCharCode(...new Uint8Array(signatureBuffer)),
  );
  if (generatedHMACBase64 !== hmacHeader) {
    console.log("HMAC Did not math failed");
    return false;
  } else {
    console.log("HMAC mathed Passed ");
    return true;
  }
}
