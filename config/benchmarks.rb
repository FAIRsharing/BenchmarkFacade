BENCHMARKS = {
  "institutional_benchmark" => {
    title: "Institutional Benchmark",
    description: "Run the institutional benchmarks on the provided URL.",
    calculation_uri: "https://docs.google.com/spreadsheets/d/1hD-dy5osuMuhnEbtPCynQUQ1ywX_WPNjsA3CHqKJfzI",
    example_url: "https://ora.ox.ac.uk/objects/uuid:4889f917-e29c-4e44-8e03-6a175c0a185f"
  },
  "life_sciences" => {
    title: "Life Sciences Repositories and Knowledgebases",
    description: "Run the life sciences benchmarks on the provided URL.",
    calculation_uri: "https://docs.google.com/spreadsheets/d/1GnUr6YiFaqGwoK2-RywnojlwGkgIsY7g1KR4eWCVdlM",
    example_url: "https://fairsharing.org/FAIRsharing.2t35ja"
  }
}.freeze

require "json"

# Share the same benchmark definitions with the Netlify function.
BENCHMARKS = JSON.parse(File.read(File.join(__dir__, "benchmarks.json")))
  .transform_values { |config| config.transform_keys(&:to_sym) }.freeze
