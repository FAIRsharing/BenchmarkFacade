require_relative "test_helper"

class ValidUrlTest < AppTestCase
  def setup
    super
    @validator = BenchmarkFacade.new!
  end

  def test_accepts_http_and_https_urls
    urls = [
      "http://example.org",
      "https://example.org",
      "https://example.org/objects/123?format=json#details",
      "http://localhost:4567/objects/123",
      "https://127.0.0.1/objects/123",
      "https://[::1]/objects/123",
      "https://example.org/objects/my%20object"
    ]

    urls.each do |url|
      assert @validator.valid_url?(url), "Expected #{url.inspect} to be valid"
    end
  end

  def test_rejects_missing_blank_and_non_string_values
    [nil, "", " ", "\t\n", 123, true, false, [], {}].each do |value|
      refute @validator.valid_url?(value), "Expected #{value.inspect} to be invalid"
    end
  end

  def test_rejects_malformed_urls
    urls = [
      "not-a-url",
      "example.org",
      "/objects/123",
      "//example.org/objects/123",
      "http://",
      "https:///objects/123",
      "https://example.org/my object",
      "https://example.org/%ZZ",
      "https://[::1",
      "https://example.org\n"
    ]

    urls.each do |url|
      refute @validator.valid_url?(url), "Expected #{url.inspect} to be invalid"
    end
  end

  def test_rejects_unsupported_schemes
    urls = [
      "ftp://example.org/objects/123",
      "file:///tmp/object",
      "mailto:person@example.org",
      "javascript:alert(1)",
      "data:text/plain,object"
    ]

    urls.each do |url|
      refute @validator.valid_url?(url), "Expected #{url.inspect} to be invalid"
    end
  end

  def test_enforces_the_url_length_limit
    prefix = "https://example.org/"

    [2047, 2048, 2049].each do |length|
      url = prefix + "a" * (length - prefix.length)

      assert_equal length <= 2048, @validator.valid_url?(url),
                   "Unexpected validation result for a URL of #{length} characters"
    end
  end
end
