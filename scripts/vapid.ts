// Usage: pnpm vapid
// Prints a fresh VAPID key pair for web push (2.12) as .env lines. Paste them into the main checkout's
// .env, set the subject to your mailto: (Apple's push service refuses a missing or bad one), and restart
// the service. Changing the pair later means every device turns "Avisarme cuando me toque" on again.
import { generateVapidKeys } from "../src/push.js";

const { publicKey, privateKey } = generateVapidKeys();
console.log(`PLANIA_VAPID_PUBLIC=${publicKey}`);
console.log(`PLANIA_VAPID_PRIVATE=${privateKey}`);
console.log("PLANIA_VAPID_SUBJECT=mailto:you@example.com");
