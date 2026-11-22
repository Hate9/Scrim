// Runs the end-to-end acceptance tests. Optional argument: a regex filter on test names.
import { main } from "./harness.mjs";
import "./p0.mjs";
import "./p1.mjs";
import "./p2.mjs";
import "./p3.mjs";
import "./p4.mjs";
import "./p5.mjs";
import "./p6.mjs";
import "./p7.mjs";

main(process.argv[2] ? new RegExp(process.argv[2]) : null).catch((e) => {
  console.error(e);
  process.exit(1);
});
