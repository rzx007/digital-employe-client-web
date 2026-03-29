import type { ElectrobunConfig } from "electrobun"
console.log (process.env.NODE_ENV)

export default {
  app: {
    name: "Digital Employee",
    identifier: "com.digitalemployee.app",
    version: "0.0.1",
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
  build: {
    bun: {
      entrypoint: "electronbun/index.ts",
    },
    copy: {
      dist: "views/main",
    },
    win: {
      bundleCEF: false,
    },
  },
  scripts: {
    preBuild: "./scripts/pre-build.ts",
  },
  release: {
    baseUrl: process.env.RELEASE_BASE_URL || "",
  },
} satisfies ElectrobunConfig
