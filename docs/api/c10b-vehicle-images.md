# C10B backend vehicle images

Frontend/gallery/licensed assets are separate pending scope. Backend stores URL/order/plain credit; it does not fetch, upload, delete or verify photo rights.

Public `GET /api/v1/vehicles` and `/{id}` add `images: [{id,url,sortOrder,attribution}]`, ordered by sortOrder then ID, empty array when absent. Existing fields/amenities remain. Admin-only endpoints:

| Method/path relative to `/api/v1/admin/vehicles/{vehicleId}/images` | Body | Success |
|---|---|---|
| GET | none | 200 `{images,revision}` |
| POST | `{url,attribution,expectedRevision}` | 201 `{images,revision}` |
| PUT `/{imageId}` | same metadata body | 200 `{images,revision}` |
| PUT `/order` | `{imageIds,expectedRevision}` | 200 `{images,revision}` |

Guest401, USER/STAFF403; missing vehicle/image or another vehicle's image on edit404. Invalid body/revision/URL/credit/permutation400; stale revision409 with no write. JSON bodies require URL and expectedRevision for metadata operations. Attribution omitted/null/blank becomes null, surrounding whitespace stripped; nonblank limit1000. URL trimmed, maximum500; HTTPS with host, no credentials/fragment/whitespace/control chars; query allowed. Root-relative only `/media/vehicles/` with alphanumeric/underscore/hyphen/dot path segments, no dot/dot-dot/empty segments, trailing slash, backslash, percent encoding, query or fragment. Filename need not have an extension. Unsafe schemes and protocol-relative paths rejected. URL content is not fetched or authenticated by this contract.

Vehicle row lock serializes media writes. Revision is lowercase SHA256 of UTF-8 JSON `{vehicleId,images}` with ordered record fields id/url/sortOrder/attribution, including literal null attribution. This is a content digest, not a monotonic version or ABA/history guarantee. Exact metadata/order no-op returns200 without media DML and keeps revision. Stale check occurs after input validation; an invalid permutation may return400 even if its revision is stale.

Append allocates UUID and maxOrder+1 (0 when empty); overflow is rejected. Reorder requires exact ID permutation, retains ID/URL/credit and uses an unoccupied contiguous integer range during its transaction to preserve UNIQUE(vehicle_id,sort_order); final orders0..n-1. No DELETE endpoint or implicit full-array replacement. Media writes preserve vehicle version/fields, amenities, other vehicles and stored booking/contract/invoice snapshots. Existing vehicle PUT ignores media fields rather than replacing links.

Proof: run `scripts/coordination/c10-vehicle-media/run-c10b-backend.ps1` in Windows PowerShell5.1 with fresh EvidenceDir. Guards and required manifest bind actual dependencies; actual isolated MySQL tests/JAR/provenance/cleanup evidence are required, compile or H2 alone is insufficient. See runner README. Photo/sample URLs in tests are fixtures and imply no license verification.
