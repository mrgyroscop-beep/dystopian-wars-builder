const response = await fetch("https://dystopian-wars-builder.mrgyroscop.workers.dev/", {
  redirect: "follow",
  signal: AbortSignal.timeout(10_000),
});

if (response.status !== 200) {
  throw new Error(`Production returned ${response.status}`);
}

console.log("Production is online.");
