require_relative "test_helper"
require "minitest/mock"

class AppTest < AppTestCase
  def setup
    super
    header "Host", "localhost"
    @guid = "https://example.org/objects/123"
  end

  def test_home_page_displays_the_guid_form
    get "/"

    assert last_response.ok?
    form = last_response.body[/<form\b[^>]*action="\/institutional_benchmark"[^>]*>.*?<\/form>/m]
    refute_nil form, "Expected a form targeting the institutional benchmark"
    assert_match(/<form\b[^>]*method="get"/, form)
    assert_match(/<label\b[^>]*for="guid"[^>]*>GUID on which to run benchmark<\/label>/, form)
    assert_match(/<input\b[^>]*type="text"[^>]*id="guid"[^>]*name="guid"/, form)
    assert_match(/<button\b[^>]*type="submit"[^>]*>run benchmark<\/button>/, form)
  end

  def test_operation_page_accepts_a_valid_guid_url
    get "/institutional_benchmark", guid: @guid

    assert last_response.ok?
    assert_includes last_response.body, BENCHMARKS["institutional_benchmark"][:title]
    assert_includes last_response.body, BENCHMARKS["institutional_benchmark"][:calculation_uri]
    assert_includes last_response.body, "data-guid=\"#{@guid}\""
    assert_includes last_response.body, 'data-endpoint="/institutional_benchmark/run"'
    assert_includes last_response.body, 'id="benchmark-results"'
    refute_includes last_response.body, "Please enter a valid HTTP or HTTPS URL"
  end

  def test_operation_page_displays_an_error_for_an_invalid_guid
    get "/institutional_benchmark", guid: "not-a-url"

    assert_equal 422, last_response.status
    assert_match(/role="alert">Please enter a valid HTTP or HTTPS URL/, last_response.body)
    refute_includes last_response.body, 'id="benchmark-loading"'
    refute_includes last_response.body, 'src="/js/benchmark.js"'
  end

  def test_operation_page_displays_an_error_for_a_missing_guid
    get "/institutional_benchmark"

    assert_equal 422, last_response.status
    assert_match(/role="alert">Please enter a valid HTTP or HTTPS URL/, last_response.body)
    refute_includes last_response.body, 'id="benchmark-loading"'
    refute_includes last_response.body, 'src="/js/benchmark.js"'
  end

  def test_unknown_operation_returns_not_found
    get "/unknown", guid: @guid

    assert_equal 404, last_response.status
  end

  def test_run_returns_benchmark_results_as_json
    results = { "score" => 0.75, "checks" => [{ "name" => "Example check", "passed" => true }] }
    client = Minitest::Mock.new
    client.expect :call, results, [],
                  calculation_uri: BENCHMARKS["institutional_benchmark"][:calculation_uri],
                  guid: @guid,
                  url: "https://champion.fairsharing.org/champion/assess/algorithm"

    ChampionClient.stub(:call, ->(**arguments) { client.call(**arguments) }) do
      post "/institutional_benchmark/run", guid: @guid
    end

    assert last_response.ok?
    assert_includes last_response.content_type, "application/json"
    assert_equal results, JSON.parse(last_response.body)
    client.verify
  end

  def test_run_returns_benchmark_client_errors_as_json
    ChampionClient.stub(:call, ->(**) { raise ChampionClient::Error, "API request timed out" }) do
      post "/institutional_benchmark/run", guid: @guid
    end

    assert_equal 502, last_response.status
    assert_includes last_response.content_type, "application/json"
    assert_equal({ "error" => "API request timed out" }, JSON.parse(last_response.body))
  end

  def test_run_with_an_unknown_operation_returns_not_found
    ChampionClient.stub(:call, ->(**) { flunk "Unknown operations must not call the API" }) do
      post "/unknown/run", guid: @guid
    end

    assert_equal 404, last_response.status
    assert_equal({ "error" => "Unknown benchmark operation." }, JSON.parse(last_response.body))
  end

  def test_operation_page_has_a_home_button
    [@guid, "invalid"].each do |guid|
      get "/institutional_benchmark", guid: guid

      assert_match(/<form\b[^>]*action="\/"[^>]*method="get"[^>]*>\s*<button\b[^>]*type="submit"[^>]*>home<\/button>\s*<\/form>/m,
                   last_response.body)
    end
  end
end
