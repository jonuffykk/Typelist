import { handleSearch } from '../server/ytm'

export async function GET(request: Request): Promise<Response> {
  const { status, body } = await handleSearch(new URL(request.url))
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600' },
  })
}
