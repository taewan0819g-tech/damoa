import type { Benefit } from "@/types/benefit";

/**
 * IMPORTANT: response field names for the 온통청년(Youth Center) Open API are
 * NOT confirmed as of 2026-08-31.
 *
 * The only documented endpoint (https://www.youthcenter.go.kr/opi/youthPlcyList.do,
 * per https://www.youthcenter.go.kr/cmnFooter/openapiIntro/oaiDoc) returns an
 * unconditional HTTP 302 redirect to `http://www.youthcenter.go.kr:8080/`
 * regardless of query parameters — confirmed via direct curl with a real
 * issued key, and that port is unreachable (connection times out). The
 * request parameter names (openApiVlak, pageIndex, display, query,
 * bizTycdSel, srchPolyBizSecd, keyword) are confirmed from the official docs
 * page, but the response schema (a "코드정의서" Excel file) is not published
 * as readable text anywhere we could fetch, and we never received a live
 * response to inspect.
 *
 * Per explicit instruction: do not invent response field names. This raw
 * type intentionally stays untyped (`Record<string, unknown>`) and
 * `normalizeYouthPolicy` intentionally returns `null` until a real response
 * sample or updated API spec is available — see YouthCenterBenefitProvider
 * for the real (currently failing) network call this feeds.
 */
export type YouthRawPolicy = Record<string, unknown>;

/**
 * Cannot safely normalize until real response field names are confirmed.
 * Returns null rather than guessing so no fabricated data ever reaches the
 * UI. Revisit once a live sample or updated spec is available.
 */
export function normalizeYouthPolicy(_raw: YouthRawPolicy): Benefit | null {
  void _raw;
  return null;
}
