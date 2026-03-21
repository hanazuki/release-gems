import { defineConfig } from "rolldown";
import { replacePlugin } from "rolldown/plugins";
import license from "rollup-plugin-license";

const banner = `\
<% for (const dependency of dependencies) {
%>---

<%= dependency.name %> -- <%= dependency.version %>
<% if (dependency.licenseText) {
%>
## License (<%= dependency.license %>)

<%= dependency.licenseText %>
<% }
%><% if (dependency.noticeText) {
%>
## Notice

<%= dependency.noticeText %>
<% }
%><% }
%>`;

const plugins = [
  replacePlugin({ "import.meta.vitest": "undefined" }),
  license({
    banner,
    thirdParty: {
      includePrivate: false,
      includeSelf: true,
      multipleVersions: true,
      output: [],
    },
  }),
];

export default defineConfig([
  {
    input: "src/build.ts",
    output: {
      file: "build/index.js",
      format: "cjs",
      codeSplitting: false,
    },
    plugins,
  },
  {
    input: "src/publish.ts",
    output: {
      file: "index.js",
      format: "cjs",
      codeSplitting: false,
    },
    plugins,
  },
]);
