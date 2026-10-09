import * as client from "openid-client";
import type { Env } from "../env.ts";

export type Provider = "entra" | "google";

interface ProviderSetup {
  issuer: URL;
  clientId: string;
  clientSecret: string;
  scope: string;
  extraParams?: Record<string, string>;
}

function setupFor(env: Env, provider: Provider): ProviderSetup | null {
  if (provider === "entra") {
    if (!env.ENTRA_TENANT_ID || !env.ENTRA_CLIENT_ID || !env.ENTRA_CLIENT_SECRET) return null;
    return {
      issuer: new URL(`https://login.microsoftonline.com/${env.ENTRA_TENANT_ID}/v2.0`),
      clientId: env.ENTRA_CLIENT_ID,
      clientSecret: env.ENTRA_CLIENT_SECRET,
      scope: "openid profile email",
    };
  }
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
  return {
    issuer: new URL("https://accounts.google.com"),
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    scope: "openid profile email",
    extraParams: env.GOOGLE_HOSTED_DOMAIN ? { hd: env.GOOGLE_HOSTED_DOMAIN } : undefined,
  };
}

export function configuredProviders(env: Env): Provider[] {
  return (["entra", "google"] as const).filter((p) => setupFor(env, p));
}

const discovered = new Map<Provider, Promise<client.Configuration>>();

async function configFor(env: Env, provider: Provider) {
  const setup = setupFor(env, provider);
  if (!setup) throw new Error(`${provider} SSO is not configured`);
  if (!discovered.has(provider)) {
    discovered.set(provider, client.discovery(setup.issuer, setup.clientId, setup.clientSecret));
  }
  return { config: await discovered.get(provider)!, setup };
}

export const callbackUrl = (env: Env, provider: Provider) => `${env.WEB_ORIGIN}/api/v1/auth/oidc/${provider}/callback`;

export interface OidcTransaction {
  provider: Provider;
  verifier: string;
  state: string;
  nonce: string;
  returnTo: string;
}

export async function startLogin(env: Env, provider: Provider, returnTo: string) {
  const { config, setup } = await configFor(env, provider);
  const verifier = client.randomPKCECodeVerifier();
  const state = client.randomState();
  const nonce = client.randomNonce();
  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: callbackUrl(env, provider),
    scope: setup.scope,
    code_challenge: await client.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
    state,
    nonce,
    prompt: "select_account",
    ...setup.extraParams,
  });
  const tx: OidcTransaction = { provider, verifier, state, nonce, returnTo };
  return { url: url.href, tx };
}

export interface VerifiedIdentity {
  source: "ENTRA" | "GOOGLE";
  externalId: string; // Entra oid / Google sub
  tenantOrDomain: string | null; // Entra tid / Google hd
  email: string | null;
  name: string | null;
}

export async function finishLogin(env: Env, tx: OidcTransaction, currentUrl: URL): Promise<VerifiedIdentity> {
  const { config } = await configFor(env, tx.provider);
  const tokens = await client.authorizationCodeGrant(config, currentUrl, {
    pkceCodeVerifier: tx.verifier,
    expectedState: tx.state,
    expectedNonce: tx.nonce,
  });
  const claims = tokens.claims();
  if (!claims) throw new Error("No ID token returned");
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  if (tx.provider === "entra") {
    return {
      source: "ENTRA",
      externalId: str(claims.oid) ?? claims.sub,
      tenantOrDomain: str(claims.tid),
      email: (str(claims.email) ?? str(claims.preferred_username))?.toLowerCase() ?? null,
      name: str(claims.name),
    };
  }
  if (env.GOOGLE_HOSTED_DOMAIN && claims.hd !== env.GOOGLE_HOSTED_DOMAIN) {
    throw new Error("Account is not in the allowed Google Workspace domain");
  }
  return {
    source: "GOOGLE",
    externalId: claims.sub,
    tenantOrDomain: str(claims.hd),
    email: claims.email_verified ? str(claims.email)?.toLowerCase() ?? null : null,
    name: str(claims.name),
  };
}
