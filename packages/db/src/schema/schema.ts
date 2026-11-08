import { pgTable, text } from "drizzle-orm/pg-core";

const webHook = pgTable("webhook", {});
