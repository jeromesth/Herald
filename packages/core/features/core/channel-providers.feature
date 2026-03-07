Feature: Channel Provider Registry
  Herald uses a ChannelRegistry to manage providers for different
  notification channels (email, in_app, sms, etc.).
  Providers are registered by channel type and looked up for delivery.

  Scenario: Register and retrieve provider by channel type
    Given a ChannelRegistry
    And a test provider for channel "email"
    When I register the provider
    Then I should be able to get the provider for "email"
    And the provider's channelType should be "email"

  Scenario: Has returns true for registered channel
    Given a ChannelRegistry with a "sms" provider
    Then the registry should report "sms" as available

  Scenario: Has returns false for unregistered channel
    Given a ChannelRegistry
    Then the registry should report "push" as unavailable

  Scenario: Get returns undefined for unregistered channel
    Given a ChannelRegistry
    When I get the provider for "webhook"
    Then the provider should be undefined

  Scenario: Provider send returns messageId and status
    Given a ChannelRegistry with a "email" provider
    When I send a message through the "email" provider
    Then the send result should have a messageId
    And the send result status should be "sent"

  Scenario: All returns all registered providers
    Given a ChannelRegistry with "email" and "sms" providers
    When I get all providers
    Then I should have 2 providers
