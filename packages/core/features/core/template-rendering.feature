Feature: Template Rendering
  Herald uses a Handlebars-style template engine for rendering
  notification content. It supports variable interpolation, HTML escaping,
  block helpers, iteration, and pipe filters.

  Background:
    Given a HandlebarsEngine

  Scenario: Simple variable interpolation
    When I render "Hello {{ name }}" with name "Alice"
    Then the rendered output should be "Hello Alice"

  Scenario: Dot-path variable resolution
    When I render "Hello {{ subscriber.firstName }}" with subscriber firstName "Alice"
    Then the rendered output should be "Hello Alice"

  Scenario: HTML escaping with double braces
    When I render "Value: {{ content }}" with content "<script>alert('xss')</script>"
    Then the rendered output should be "Value: &lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;"

  Scenario: Raw output with triple braces
    When I render "Value: {{{ content }}}" with content "<b>bold</b>"
    Then the rendered output should be "Value: <b>bold</b>"

  Scenario: If block renders truthy branch
    When I render "{{#if active}}Yes{{else}}No{{/if}}" with active true
    Then the rendered output should be "Yes"

  Scenario: If block renders else branch
    When I render "{{#if active}}Yes{{else}}No{{/if}}" with active false
    Then the rendered output should be "No"

  Scenario: Each loop with index
    When I render "{{#each items}}{{@index}}:{{name}} {{/each}}" with items
      | name  |
      | Alice |
      | Bob   |
    Then the rendered output should be "0:Alice 1:Bob "

  Scenario: Uppercase filter
    When I render "{{ name | uppercase }}" with name "alice"
    Then the rendered output should be "ALICE"

  Scenario: Lowercase filter
    When I render "{{ name | lowercase }}" with name "ALICE"
    Then the rendered output should be "alice"

  Scenario: Default filter for missing values
    When I render "{{ missing | default fallback }}" with no variables
    Then the rendered output should be "fallback"

  Scenario: Truncate filter
    When I render "{{ text | truncate 5 }}" with text "Hello World"
    Then the rendered output should be "Hello..."
