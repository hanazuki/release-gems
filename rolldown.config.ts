import type { RolldownOptions } from "rolldown";
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

export default ["build", "publish"].map(
  (name): RolldownOptions => ({
    input: `src/${name}.ts`,
    output: {
      file: `dist/${name}.js`,
      format: "cjs",
      codeSplitting: false,
    },
    plugins,
  }),
);
