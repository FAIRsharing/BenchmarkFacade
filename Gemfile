source 'https://gem.coop'
git_source(:github) { |repo| "https://github.com/#{repo}.git" }

gem "sinatra"
gem "httparty"
gem "puma"
gem "rackup"
gem "rake"

gem "sinatra-contrib", group: :development

group :test do
  gem "minitest", "~> 5.0"
  gem "rack-test"
  gem "simplecov", require: false
end
