import React from "react";

interface AvatarProps {
  name: string;
  size?: number;
  colorIndex?: number;
}

const avatarColors = [
  ["#667eea", "#764ba2"], // Purple
  ["#f093fb", "#f5576c"], // Pink
  ["#4facfe", "#00f2fe"], // Blue
  ["#43e97b", "#38f9d7"], // Green
  ["#fa709a", "#fee140"], // Orange-pink
  ["#a8edea", "#fed6e3"], // Soft teal
  ["#ff9a9e", "#fecfef"], // Soft pink
  ["#ffecd2", "#fcb69f"], // Peach
];

const getInitials = (name: string): string => {
  const parts = name.split(" ");
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
};

const hashString = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
};

export const Avatar = ({ name, size = 40, colorIndex }: AvatarProps) => {
  const initials = getInitials(name);
  const index = colorIndex ?? hashString(name) % avatarColors.length;
  const [color1, color2] = avatarColors[index];

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 6,
        background: `linear-gradient(135deg, ${color1} 0%, ${color2} 100%)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.4,
        fontWeight: 700,
        color: "#ffffff",
        textShadow: "0 1px 2px rgba(0,0,0,0.2)",
        flexShrink: 0,
      }}
    >
      {initials}
    </div>
  );
};
