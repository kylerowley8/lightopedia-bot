import { AbsoluteFill } from "remotion";
import React from "react";
import { LightLogo } from "../assets/LightLogo";

interface SlackWindowProps {
  children: React.ReactNode;
  channelName?: string;
  scrollY?: number;
}

export const SlackWindow = ({
  children,
  channelName = "lightopedia",
  scrollY = 0,
}: SlackWindowProps) => {
  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#000000",
        padding: 60,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        style={{
          width: 1400,
          height: 800,
          backgroundColor: "#1a1d21",
          borderRadius: 12,
          boxShadow: `
            0 50px 100px rgba(0,0,0,0.6),
            0 15px 35px rgba(0,0,0,0.4),
            0 5px 15px rgba(0,0,0,0.3),
            inset 0 1px 0 rgba(255,255,255,0.05)
          `,
          border: "1px solid rgba(255,255,255,0.1)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Slack Header */}
        <div
          style={{
            backgroundColor: "#350d36",
            padding: "12px 20px",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          {/* Window controls */}
          <div style={{ display: "flex", gap: 8 }}>
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                backgroundColor: "#ff5f56",
                boxShadow: "0 0 8px rgba(255,95,86,0.5)",
              }}
            />
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                backgroundColor: "#ffbd2e",
                boxShadow: "0 0 8px rgba(255,189,46,0.5)",
              }}
            />
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                backgroundColor: "#27c93f",
                boxShadow: "0 0 8px rgba(39,201,63,0.5)",
              }}
            />
          </div>

          {/* Workspace name */}
          <div style={{ marginLeft: 20 }}>
            <LightLogo width={65} height={20} />
          </div>
        </div>

        {/* Main content area */}
        <div style={{ display: "flex", flex: 1 }}>
          {/* Sidebar */}
          <div
            style={{
              width: 260,
              backgroundColor: "#350d36",
              padding: "16px 0",
              display: "flex",
              flexDirection: "column",
              boxShadow: "4px 0 15px rgba(0,0,0,0.3)",
              zIndex: 1,
            }}
          >
            {/* Channels section */}
            <div style={{ padding: "8px 16px", color: "#ffffff99", fontSize: 13 }}>
              Channels
            </div>
            <SidebarItem name="general" />
            <SidebarItem name={channelName} active />
          </div>

          {/* Chat area */}
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              backgroundColor: "#1a1d21",
            }}
          >
            {/* Channel header */}
            <div
              style={{
                padding: "16px 24px",
                borderBottom: "1px solid #383838",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span style={{ color: "#b9bbbe", fontSize: 18 }}>#</span>
              <span style={{ color: "#ffffff", fontSize: 18, fontWeight: 600 }}>
                {channelName}
              </span>
            </div>

            {/* Messages area */}
            <div
              style={{
                flex: 1,
                padding: "24px",
                overflow: "hidden",
                position: "relative",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                  transform: `translateY(-${scrollY}px)`,
                }}
              >
                {children}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const SidebarItem = ({
  name,
  active = false,
}: {
  name: string;
  active?: boolean;
}) => (
  <div
    style={{
      padding: "6px 16px",
      color: active ? "#ffffff" : "#ffffff99",
      fontSize: 15,
      backgroundColor: active ? "#1164a3" : "transparent",
      display: "flex",
      alignItems: "center",
      gap: 8,
    }}
  >
    <span style={{ opacity: 0.7 }}>#</span>
    {name}
  </div>
);
