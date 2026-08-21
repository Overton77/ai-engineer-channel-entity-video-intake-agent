import { eveChannel } from "eve/channels/eve";
import { localDev, none, placeholderAuth, vercelOidc } from "eve/channels/auth";

const localBuiltServerAuth =
  process.env.PRE_RESEARCH_LOCAL_EVE_START === "true" ? [none()] : [];

export default eveChannel({
  auth: [
    // Lets the eve TUI and your Vercel deployments reach the deployed agent.
    vercelOidc(),
    // Open on localhost for `eve dev` and the REPL; ignored in production.
    localDev(),
    // Explicit opt-in for a built server bound to 127.0.0.1 during local batch
    // runs. Leave unset in Vercel/remote environments.
    ...localBuiltServerAuth,
    // This placeholder will not allow browser requests in production.
    // Replace it with your app's auth provider, like Auth.js or Clerk,
    // or use none() for a public demo.
    placeholderAuth(),
  ],
});
