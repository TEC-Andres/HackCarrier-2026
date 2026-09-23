export function GET() {
  return Response.json({
    message: "Hello World from the backend",
    source: "route",
  });
}
