require "httparty"
require "json"
require "logger"

class ChampionClient
  class Error < StandardError; end

  # Send the calculation URI and GUID to the benchmark API.
  def self.call(calculation_uri:, guid:, url:, logger: Logger.new($stderr))
    started_at = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    options = {
      body: JSON.generate(calculation_uri: calculation_uri, guid: guid),
      open_timeout: 5,
      # The remote benchmark can take more than 15 seconds to produce a response.
      read_timeout: 60,
      write_timeout: 15,
      headers: {
        "Accept" => "application/json",
        "Content-Type" => "application/json"
      }
    }

    logger.info(JSON.generate(
      event: "champion_request", method: "POST", url: url,
      headers: options[:headers], body: options[:body],
      open_timeout: options[:open_timeout], read_timeout: options[:read_timeout],
      write_timeout: options[:write_timeout]
    ))

    response = HTTParty.post(url, **options)
    logger.info(JSON.generate(
      event: "champion_response", url: url, status: response.code,
      elapsed_seconds: (Process.clock_gettime(Process::CLOCK_MONOTONIC) - started_at).round(3)
    ))

    unless response.success?
      raise Error, "API returned HTTP #{response.code}"
    end

    JSON.parse(response.body)

  rescue Error, HTTParty::Error, SocketError, Timeout::Error, SystemCallError, JSON::ParserError => e
    logger.error(JSON.generate(
      event: "champion_error", url: url, error_class: e.class.name, message: e.message,
      elapsed_seconds: (Process.clock_gettime(Process::CLOCK_MONOTONIC) - started_at).round(3)
    ))
    raise if e.is_a?(Error)

    raise Error, "API request failed: #{e.message}"
  end
end
