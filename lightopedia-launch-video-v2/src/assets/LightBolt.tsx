import React from "react";

interface LightBoltProps {
  size?: number;
  fill?: string;
  style?: React.CSSProperties;
}

export const LightBolt = ({
  size = 60,
  fill = "black",
  style,
}: LightBoltProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 60 60"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={style}
  >
    <path
      d="M58.6596 53.5724H1.89697L12.9956 35.3601L3.33097 38.1683L2.25547 34.4639L15.9085 30.58L30.2782 7L40.4684 23.7193L15.9085 30.58L50.13 39.6083L58.6596 53.5724Z"
      fill={fill}
    />
  </svg>
);
