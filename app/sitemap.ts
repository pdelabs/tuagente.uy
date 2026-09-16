import type { MetadataRoute } from "next";
import { POSTS } from "./blog/posts";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://tuagente.uy",
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: "https://tuagente.uy/blog",
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: "https://tuagente.uy/privacidad",
      lastModified: new Date("2026-09-16"),
      changeFrequency: "yearly",
      priority: 0.3,
    },
    ...POSTS.map((p) => ({
      url: `https://tuagente.uy/blog/${p.slug}`,
      lastModified: new Date(p.date),
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];
}
