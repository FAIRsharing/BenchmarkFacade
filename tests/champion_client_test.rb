require_relative "test_helper"
require "minitest/mock"
require "stringio"

class ChampionClientTest < Minitest::Test
  def setup
    super
    @log_output = StringIO.new
    @arguments = {
      calculation_uri: "https://example.org/algorithm",
      guid: "https://example.org/object",
      url: "https://example.org/assess",
      logger: Logger.new(@log_output)
    }
  end

  def test_posts_json_and_parses_the_response
    response = Minitest::Mock.new
    response.expect :code, 200
    response.expect :success?, true
    response.expect :body, '{"score":0.75}'
    request = lambda do |url, **options|
      assert_equal @arguments[:url], url
      assert_equal({ "calculation_uri" => @arguments[:calculation_uri], "guid" => @arguments[:guid] },
                   JSON.parse(options[:body]))
      assert_equal "application/json", options[:headers]["Accept"]
      assert_equal "application/json", options[:headers]["Content-Type"]
      assert_equal 5, options[:open_timeout]
      assert_equal 60, options[:read_timeout]
      assert_equal 15, options[:write_timeout]
      response
    end

    HTTParty.stub(:post, request) do
      assert_equal({ "score" => 0.75 }, ChampionClient.call(**@arguments))
    end
    response.verify
  end

  def test_reports_unsuccessful_responses
    response = Minitest::Mock.new
    response.expect :success?, false
    response.expect :code, 503
    response.expect :code, 503

    HTTParty.stub(:post, response) do
      error = assert_raises(ChampionClient::Error) { ChampionClient.call(**@arguments) }
      assert_equal "API returned HTTP 503", error.message
    end
    response.verify
  end

  def test_reports_timeouts
    HTTParty.stub(:post, ->(*) { raise Timeout::Error, "Request timed out" }) do
      error = assert_raises(ChampionClient::Error) { ChampionClient.call(**@arguments) }
      assert_includes error.message, "Request timed out"
    end

    entries = @log_output.string.lines.map { |line| JSON.parse(line.split(" -- : ", 2).last) }
    request, failure = entries
    assert_equal "champion_request", request["event"]
    assert_equal "POST", request["method"]
    assert_equal @arguments[:url], request["url"]
    assert_equal({ "Accept" => "application/json", "Content-Type" => "application/json" }, request["headers"])
    assert_equal JSON.generate(calculation_uri: @arguments[:calculation_uri], guid: @arguments[:guid]), request["body"]
    assert_equal 5, request["open_timeout"]
    assert_equal 60, request["read_timeout"]
    assert_equal 15, request["write_timeout"]
    assert_equal "champion_error", failure["event"]
    assert_equal "Timeout::Error", failure["error_class"]
    assert_equal "Request timed out", failure["message"]
    assert_operator failure["elapsed_seconds"], :>=, 0
  end

  def test_reports_invalid_json
    response = Minitest::Mock.new
    response.expect :code, 200
    response.expect :success?, true
    response.expect :body, "not JSON"

    HTTParty.stub(:post, response) do
      assert_raises(ChampionClient::Error) { ChampionClient.call(**@arguments) }
    end
    response.verify
  end
end
