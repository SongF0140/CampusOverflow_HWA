import { defineHandler } from "nitro";
import { checkWorkflowAccess } from "../src/runtime/workflow-access.js";

export default defineHandler(event => checkWorkflowAccess(event.url.pathname, process.env));
