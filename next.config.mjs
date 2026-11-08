/** @type {import('next').NextConfig} */
export default {
  // pipeline output is read from disk at request time; make sure it ships with the functions
  outputFileTracingIncludes: { '/**': ['./data/**/*.json', './config/**/*.json'] },
  serverExternalPackages: ['unpdf'],
}
