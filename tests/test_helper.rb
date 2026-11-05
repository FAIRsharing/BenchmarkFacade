ENV["APP_ENV"] = "test"
ENV["RACK_ENV"] = "test"

require "bundler/setup"
require "simplecov"

SimpleCov.start do
  root File.expand_path("..", __dir__)
  skip "/tests/"
end

require "minitest/autorun"
require "rack/test"
require_relative "../benchmark_facade"

class AppTestCase < Minitest::Test
  include Rack::Test::Methods

  def app
    BenchmarkFacade
  end
end
