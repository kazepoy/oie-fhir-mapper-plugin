// SPDX-License-Identifier: MPL-2.0
import { t as tr } from "../i18n/index.js";
// The Web Admin platform object, kept here so that the host/ modules share it.

/** @type {any} */
let current = null;

export function bindPlatform(platform) {
  current = platform;
}

/** @returns {any} */
export function platform() {
  if (!current) throw new Error(tr("host.fhir_mapper_the_platform_is_not"));
  return current;
}

/** A short notification in the corner of the page. */
export function toast(message, type = "info") {
  current?.ui?.toast?.(message, type);
}
