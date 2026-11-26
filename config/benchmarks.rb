require "json"

# Share the same benchmark definitions with the Netlify function.
BENCHMARKS = JSON.parse(File.read(File.join(__dir__, "benchmarks.json")))
  .transform_values { |config| config.transform_keys(&:to_sym) }.freeze
