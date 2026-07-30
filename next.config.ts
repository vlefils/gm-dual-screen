import type { NextConfig } from "next";

const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const isProjectPage =
  Boolean(repositoryName) && !repositoryName?.endsWith(".github.io");
const pagesBasePath =
  process.env.STATIC_EXPORT === "true" && isProjectPage
    ? `/${repositoryName}`
    : "";

const nextConfig: NextConfig = {
  output: process.env.STATIC_EXPORT === "true" ? "export" : undefined,
  trailingSlash: true,
  basePath: pagesBasePath,
  assetPrefix: pagesBasePath,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
