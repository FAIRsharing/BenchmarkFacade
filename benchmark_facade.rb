require "sinatra"
require "json"
require "uri"
require_relative "config/benchmarks"
require_relative "services/champion_client"

class BenchmarkFacade < Sinatra::Base

  configure :development do
    # simplecov:disable
    require "sinatra/reloader"
    register Sinatra::Reloader

    also_reload "./services/*.rb"
    also_reload "./config/*.rb"

    set :bind, "127.0.0.1"
    set :port, 4567
    set :show_exceptions, true
    # simplecov:enable
  end

  configure :production do
    # TODO
  end

  # The server posts benchmark requests to this external API.
  url = 'https://champion.fairsharing.org/champion/assess/algorithm'

  # Here's the Champion's example for the above URL:
  # curl -X POST -H "Accept: application/json" -H "Content-type: application/json"
  #       -d  '{"guid":  "https://my.favorite.digital/object"}'
  #            https://w3id.org/FAIR-Champion/assess/algorithm/d/AJURG8ewy45hIUDH38rhU
  # The last URL is the calculation_uri from bencmarks.rb

  get "/" do
    @benchmarks = BENCHMARKS
    erb :index
  end

  get "/:operation" do
    @operation = params[:operation]
    @config = BENCHMARKS[@operation]
    @guid = params[:guid]

    halt 404 unless @config

    unless valid_url?(@guid)
      @error = "Please enter a valid HTTP or HTTPS URL for the GUID (maximum 2048 characters)."
      status 422
    end

    erb :run_benchmark
  end

  post "/:operation/run" do
    @operation = params[:operation]
    @config = BENCHMARKS[@operation]

    content_type :json
    halt 404, JSON.generate(error: "Unknown benchmark operation.") unless @config

    @guid = params[:guid]

    unless valid_url?(@guid)
      halt 422, JSON.generate(error: "Please enter a valid HTTP or HTTPS URL for the GUID (maximum 2048 characters).")
    end

    begin
      results = ChampionClient.call(
        calculation_uri: @config[:calculation_uri],
        guid: @guid,
        url: url
      )
    rescue ChampionClient::Error => e
      halt 502, JSON.generate(error: e.message)
    end

    JSON.generate(results)
  end

  helpers do
    def valid_url?(value)
      return false unless value.is_a?(String)

      uri = URI.parse(value)

      uri.is_a?(URI::HTTP) &&
        !uri.host.to_s.empty? &&
        value.length <= 2048
    rescue URI::InvalidURIError
      false
    end
  end
end
