import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postmarkProvider } from "../src/channels/email/postmark.js";
import { resendProvider } from "../src/channels/email/resend.js";
import { sendgridProvider } from "../src/channels/email/sendgrid.js";
import { sesProvider } from "../src/channels/email/ses.js";

describe("Email Providers", () => {
	const mockFetch = vi.fn();

	beforeEach(() => {
		mockFetch.mockReset();
		vi.stubGlobal("fetch", mockFetch);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("resendProvider", () => {
		it("sends email via Resend API", async () => {
			mockFetch.mockResolvedValue(new Response(JSON.stringify({ id: "msg-resend-1" }), { status: 200 }));

			const provider = resendProvider({
				apiKey: "re_test_key",
				from: "noreply@test.com",
			});

			expect(provider.providerId).toBe("resend");
			expect(provider.channelType).toBe("email");

			const result = await provider.send({
				subscriberId: "sub-1",
				to: "user@test.com",
				subject: "Hello",
				body: "<p>Test</p>",
			});

			expect(result.messageId).toBe("msg-resend-1");
			expect(result.status).toBe("sent");
			expect(mockFetch).toHaveBeenCalledOnce();

			const [url, opts] = mockFetch.mock.calls[0];
			expect(url).toBe("https://api.resend.com/emails");
			expect(opts.headers.Authorization).toBe("Bearer re_test_key");
		});

		it("returns failure on non-ok response", async () => {
			mockFetch.mockResolvedValue(new Response("Unauthorized", { status: 401 }));

			const provider = resendProvider({ apiKey: "bad-key", from: "noreply@test.com" });
			const result = await provider.send({
				subscriberId: "sub-1",
				to: "user@test.com",
				body: "Test",
			});

			expect(result.status).toBe("failed");
			expect(result.error).toContain("401");
		});

		it("uses custom apiUrl when provided", async () => {
			mockFetch.mockResolvedValue(new Response(JSON.stringify({ id: "msg-1" }), { status: 200 }));

			const provider = resendProvider({
				apiKey: "key",
				from: "noreply@test.com",
				apiUrl: "https://custom.api/emails",
			});

			await provider.send({ subscriberId: "sub-1", to: "user@test.com", body: "Test" });
			expect(mockFetch.mock.calls[0][0]).toBe("https://custom.api/emails");
		});
	});

	describe("sendgridProvider", () => {
		it("sends email via SendGrid API", async () => {
			const headers = new Headers();
			headers.set("X-Message-Id", "sg-msg-1");
			mockFetch.mockResolvedValue(new Response(null, { status: 202, headers }));

			const provider = sendgridProvider({
				apiKey: "sg_test_key",
				from: "noreply@test.com",
			});

			expect(provider.providerId).toBe("sendgrid");
			expect(provider.channelType).toBe("email");

			const result = await provider.send({
				subscriberId: "sub-1",
				to: "user@test.com",
				subject: "Hello",
				body: "<p>Test</p>",
			});

			expect(result.messageId).toBe("sg-msg-1");
			expect(result.status).toBe("sent");
		});

		it("generates UUID when X-Message-Id header is missing", async () => {
			mockFetch.mockResolvedValue(new Response(null, { status: 202 }));

			const provider = sendgridProvider({ apiKey: "key", from: "noreply@test.com" });
			const result = await provider.send({
				subscriberId: "sub-1",
				to: "user@test.com",
				body: "Test",
			});

			expect(result.messageId).toBeTruthy();
			expect(result.status).toBe("sent");
		});

		it("returns failure on non-ok response", async () => {
			mockFetch.mockResolvedValue(new Response("Forbidden", { status: 403 }));

			const provider = sendgridProvider({ apiKey: "bad", from: "noreply@test.com" });
			const result = await provider.send({
				subscriberId: "sub-1",
				to: "user@test.com",
				body: "Test",
			});

			expect(result.status).toBe("failed");
			expect(result.error).toContain("403");
		});

		it("uses custom apiUrl when provided", async () => {
			mockFetch.mockResolvedValue(new Response(null, { status: 202 }));

			const provider = sendgridProvider({
				apiKey: "key",
				from: "noreply@test.com",
				apiUrl: "https://custom.sg/v3/mail/send",
			});

			await provider.send({ subscriberId: "sub-1", to: "user@test.com", body: "Test" });
			expect(mockFetch.mock.calls[0][0]).toBe("https://custom.sg/v3/mail/send");
		});
	});

	describe("postmarkProvider", () => {
		it("sends email via Postmark API", async () => {
			mockFetch.mockResolvedValue(new Response(JSON.stringify({ MessageID: "pm-msg-1" }), { status: 200 }));

			const provider = postmarkProvider({
				serverToken: "pm_token",
				from: "noreply@test.com",
			});

			expect(provider.providerId).toBe("postmark");
			expect(provider.channelType).toBe("email");

			const result = await provider.send({
				subscriberId: "sub-1",
				to: "user@test.com",
				subject: "Hello",
				body: "<p>Test</p>",
			});

			expect(result.messageId).toBe("pm-msg-1");
			expect(result.status).toBe("sent");

			const [url, opts] = mockFetch.mock.calls[0];
			expect(url).toBe("https://api.postmarkapp.com/email");
			expect(opts.headers["X-Postmark-Server-Token"]).toBe("pm_token");

			const payload = JSON.parse(opts.body);
			expect(payload.MessageStream).toBe("outbound");
		});

		it("uses custom message stream", async () => {
			mockFetch.mockResolvedValue(new Response(JSON.stringify({ MessageID: "pm-msg-2" }), { status: 200 }));

			const provider = postmarkProvider({
				serverToken: "pm_token",
				from: "noreply@test.com",
				messageStream: "transactional",
			});

			await provider.send({ subscriberId: "sub-1", to: "user@test.com", body: "Test" });
			const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
			expect(payload.MessageStream).toBe("transactional");
		});

		it("returns failure on non-ok response", async () => {
			mockFetch.mockResolvedValue(new Response("Invalid", { status: 422 }));

			const provider = postmarkProvider({ serverToken: "bad", from: "noreply@test.com" });
			const result = await provider.send({
				subscriberId: "sub-1",
				to: "user@test.com",
				body: "Test",
			});

			expect(result.status).toBe("failed");
			expect(result.error).toContain("422");
		});

		it("uses custom apiUrl when provided", async () => {
			mockFetch.mockResolvedValue(new Response(JSON.stringify({ MessageID: "pm-1" }), { status: 200 }));

			const provider = postmarkProvider({
				serverToken: "tok",
				from: "noreply@test.com",
				apiUrl: "https://custom.pm/email",
			});

			await provider.send({ subscriberId: "sub-1", to: "user@test.com", body: "Test" });
			expect(mockFetch.mock.calls[0][0]).toBe("https://custom.pm/email");
		});
	});

	describe("sesProvider", () => {
		it("sends email via custom send function", async () => {
			const mockSend = vi.fn().mockResolvedValue("ses-msg-1");

			const provider = sesProvider({
				from: "noreply@test.com",
				send: mockSend,
			});

			expect(provider.providerId).toBe("ses");
			expect(provider.channelType).toBe("email");

			const result = await provider.send({
				subscriberId: "sub-1",
				to: "user@test.com",
				subject: "Hello",
				body: "<p>Test</p>",
			});

			expect(result.messageId).toBe("ses-msg-1");
			expect(result.status).toBe("sent");
			expect(mockSend).toHaveBeenCalledWith({
				to: "user@test.com",
				subject: "Hello",
				html: "<p>Test</p>",
				from: "noreply@test.com",
			});
		});

		it("returns failure when send function throws", async () => {
			const mockSend = vi.fn().mockRejectedValue(new Error("SES quota exceeded"));

			const provider = sesProvider({ from: "noreply@test.com", send: mockSend });
			const result = await provider.send({
				subscriberId: "sub-1",
				to: "user@test.com",
				body: "Test",
			});

			expect(result.status).toBe("failed");
			expect(result.error).toBe("SES send failed");
		});

		it("handles non-Error throw values", async () => {
			const mockSend = vi.fn().mockRejectedValue("string error");

			const provider = sesProvider({ from: "noreply@test.com", send: mockSend });
			const result = await provider.send({
				subscriberId: "sub-1",
				to: "user@test.com",
				body: "Test",
			});

			expect(result.status).toBe("failed");
			expect(result.error).toBe("SES send failed");
		});
	});
});
