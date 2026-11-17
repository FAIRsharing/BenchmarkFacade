require_relative "test_helper"
require "minitest/mock"

class BenchmarkRunTest < AppTestCase
  def setup
    super
    header "Host", "localhost"
    @guid = "https://example.org/object?name=a&format=json"
  end

  def test_page_loads_the_script_and_spinner_without_calling_the_api
    ChampionClient.stub(:call, ->(**) { flunk "Page rendering must not call the API" }) do
      get "/institutional_benchmark", guid: @guid
    end

    assert last_response.ok?
    script_version = Digest::SHA256.file(File.expand_path("../public/js/benchmark.js", __dir__)).hexdigest[0, 12]
    style_version = Digest::SHA256.file(File.expand_path("../public/css/custom.css", __dir__)).hexdigest[0, 12]
    assert_includes last_response.body, "src=\"/js/benchmark.js?v=#{script_version}\" defer"
    assert_includes last_response.body, "href=\"/css/custom.css?v=#{style_version}\""
    assert_includes last_response.body, 'id="benchmark-table"'
    refute_includes last_response.body, 'id="benchmark-json"'
    assert_includes last_response.body, 'id="benchmark-loading"'
    assert_includes last_response.body, Rack::Utils.escape_html(@guid)
    [@guid, BENCHMARKS["institutional_benchmark"][:calculation_uri]].each do |url|
      assert_includes last_response.body, "href=\"#{Rack::Utils.escape_html(url)}\" target=\"_blank\" rel=\"noopener noreferrer\""
    end
  end

  def test_invalid_guid_does_not_start_a_benchmark
    get "/institutional_benchmark", guid: "invalid"

    assert_equal 422, last_response.status
    assert_includes last_response.body, "Please enter a valid HTTP or HTTPS URL"
    refute_includes last_response.body, 'src="/js/benchmark.js"'
  end

  def test_run_returns_json_from_the_configured_benchmark
    results = { "score" => 0.75, "checks" => [] }
    client = lambda do |calculation_uri:, guid:, url:|
      assert_equal BENCHMARKS["institutional_benchmark"][:calculation_uri], calculation_uri
      assert_equal @guid, guid
      assert_equal "https://champion.fairsharing.org/champion/assess/algorithm", url
      results
    end

    ChampionClient.stub(:call, client) do
      post "/institutional_benchmark/run", guid: @guid
    end

    assert last_response.ok?
    assert_includes last_response.content_type, "application/json"
    assert_equal results, JSON.parse(last_response.body)
  end

  def test_run_rejects_invalid_and_missing_guids_without_calling_the_api
    ChampionClient.stub(:call, ->(**) { flunk "Invalid GUID must not reach the API" }) do
      [nil, "invalid"].each do |guid|
        post "/institutional_benchmark/run", guid: guid

        assert_equal 422, last_response.status
        assert_includes JSON.parse(last_response.body)["error"], "valid HTTP or HTTPS URL"
      end
    end
  end

  def test_run_returns_api_errors_as_json
    ChampionClient.stub(:call, ->(**) { raise ChampionClient::Error, "API returned HTTP 503" }) do
      post "/institutional_benchmark/run", guid: @guid
    end

    assert_equal 502, last_response.status
    assert_equal "API returned HTTP 503", JSON.parse(last_response.body)["error"]
  end

  def test_unknown_operation_returns_a_json_error
    post "/unknown/run", guid: @guid

    assert_equal 404, last_response.status
    assert_equal "Unknown benchmark operation.", JSON.parse(last_response.body)["error"]
  end
end
