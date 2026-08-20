import { expect, it } from "vitest";
import { secureSessionCookie } from "../src/server/security/cookie-security";

it("allows direct HTTP Docker sessions while retaining HTTPS secure cookies", () => {
  expect(
    secureSessionCookie(new Headers(), "http://192.168.1.10:8787/login"),
  ).toBe(false);
  expect(
    secureSessionCookie(new Headers(), "https://playlarr.example/login"),
  ).toBe(true);
  expect(
    secureSessionCookie(
      new Headers({ "x-forwarded-proto": "https" }),
      "http://127.0.0.1:8787/login",
    ),
  ).toBe(true);
  expect(
    secureSessionCookie(
      new Headers({ "x-forwarded-proto": "http" }),
      "http://127.0.0.1:8787/login",
    ),
  ).toBe(false);
});
