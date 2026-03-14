import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { ChannelRegistry } from "../../src/channels/provider.js";
import type { ChannelProvider, ChannelProviderMessage, ChannelProviderResult } from "../../src/channels/provider.js";

interface ProviderWorld {
	registry: ChannelRegistry;
	provider: ChannelProvider | undefined;
	sendResult: ChannelProviderResult | null;
	allProviders: Map<string, ChannelProvider>;
	testProvider: ChannelProvider | null;
}

function createTestProvider(channelType: string): ChannelProvider {
	return {
		providerId: `test-${channelType}`,
		channelType: channelType as ChannelProvider["channelType"],
		async send(_message: ChannelProviderMessage): Promise<ChannelProviderResult> {
			return { messageId: `msg-${crypto.randomUUID()}`, status: "sent" };
		},
	};
}

Given("a ChannelRegistry", function (this: ProviderWorld) {
	this.registry = new ChannelRegistry();
	this.provider = undefined;
	this.sendResult = null;
	this.allProviders = new Map();
	this.testProvider = null;
});

Given("a test provider for channel {string}", function (this: ProviderWorld, channelType: string) {
	this.testProvider = createTestProvider(channelType);
});

Given("a ChannelRegistry with a {string} provider", function (this: ProviderWorld, channelType: string) {
	this.registry = new ChannelRegistry();
	this.registry.register(createTestProvider(channelType));
	this.provider = undefined;
	this.sendResult = null;
	this.allProviders = new Map();
	this.testProvider = null;
});

Given("a ChannelRegistry with {string} and {string} providers", function (this: ProviderWorld, type1: string, type2: string) {
	this.registry = new ChannelRegistry();
	this.registry.register(createTestProvider(type1));
	this.registry.register(createTestProvider(type2));
	this.provider = undefined;
	this.sendResult = null;
	this.allProviders = new Map();
	this.testProvider = null;
});

When("I register the provider", function (this: ProviderWorld) {
	assert.ok(this.testProvider, "Test provider must be created first");
	this.registry.register(this.testProvider);
});

When("I get the provider for {string}", function (this: ProviderWorld, channelType: string) {
	this.provider = this.registry.get(channelType);
});

When("I send a message through the {string} provider", async function (this: ProviderWorld, channelType: string) {
	const provider = this.registry.get(channelType);
	assert.ok(provider, `Expected provider for "${channelType}"`);
	this.sendResult = await provider.send({
		subscriberId: "sub-1",
		to: "test@example.com",
		body: "Test message",
	});
});

When("I get all providers", function (this: ProviderWorld) {
	this.allProviders = this.registry.all();
});

Then("I should be able to get the provider for {string}", function (this: ProviderWorld, channelType: string) {
	const provider = this.registry.get(channelType);
	assert.ok(provider, `Expected provider for "${channelType}"`);
});

Then("the provider's channelType should be {string}", function (this: ProviderWorld, channelType: string) {
	const provider = this.registry.get(channelType);
	assert.ok(provider, "Expected provider");
	assert.strictEqual(provider.channelType, channelType);
});

Then("the registry should report {string} as available", function (this: ProviderWorld, channelType: string) {
	assert.strictEqual(this.registry.has(channelType), true);
});

Then("the registry should report {string} as unavailable", function (this: ProviderWorld, channelType: string) {
	assert.strictEqual(this.registry.has(channelType), false);
});

Then("the provider should be undefined", function (this: ProviderWorld) {
	assert.strictEqual(this.provider, undefined);
});

Then("the send result should have a messageId", function (this: ProviderWorld) {
	assert.ok(this.sendResult, "Expected a send result");
	assert.ok(this.sendResult.messageId, "Expected a messageId");
});

Then("the send result status should be {string}", function (this: ProviderWorld, status: string) {
	assert.ok(this.sendResult, "Expected a send result");
	assert.strictEqual(this.sendResult.status, status);
});

Then("I should have {int} providers", function (this: ProviderWorld, count: number) {
	assert.strictEqual(this.allProviders.size, count);
});
