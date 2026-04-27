"use client";

const COLORS = [
  "from-purple-500 to-pink-500",
  "from-blue-500 to-cyan-500",
  "from-green-500 to-emerald-500",
  "from-orange-500 to-red-500",
  "from-indigo-500 to-purple-500",
  "from-pink-500 to-rose-500",
  "from-teal-500 to-blue-500",
  "from-yellow-500 to-orange-500",
];

function hashColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) & 0xfffffff;
  return COLORS[h % COLORS.length];
}

export function UserAvatar({
  email, name, size = 32, src,
}: {
  email: string;
  name?: string | null;
  size?: number;
  src?: string | null;
}) {
  if (src) {
    return (
      <img src={src} alt=""
           style={{ width: size, height: size }}
           className="rounded-full object-cover" />
    );
  }
  const text = (name || email || "?").charAt(0).toUpperCase();
  const gradient = hashColor(email || name || "");
  return (
    <div
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      className={`rounded-full flex items-center justify-center font-bold text-white
                  bg-gradient-to-br ${gradient} flex-shrink-0`}
    >
      {text}
    </div>
  );
}
