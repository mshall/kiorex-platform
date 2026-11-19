import { View } from "react-native";
import Svg, { Circle, Path, Polyline, Line, Rect } from "react-native-svg";
import { useTranslation } from "react-i18next";
import { isRtlLang } from "@/i18n";

// 24x24 stroke icons (Lucide-style geometry, drawn inline so no icon font is needed on web/native).
const P: Record<string, (c: string) => React.ReactNode> = {
  home: (c) => <><Path d="M3 11l9-8 9 8" stroke={c} /><Path d="M5 10v10h14V10" stroke={c} /></>,
  calendar: (c) => <><Rect x="3" y="5" width="18" height="16" rx="2" stroke={c} /><Line x1="3" y1="10" x2="21" y2="10" stroke={c} /><Line x1="8" y1="3" x2="8" y2="7" stroke={c} /><Line x1="16" y1="3" x2="16" y2="7" stroke={c} /></>,
  user: (c) => <><Circle cx="12" cy="8" r="4" stroke={c} /><Path d="M4 21c0-4 4-6 8-6s8 2 8 6" stroke={c} /></>,
  search: (c) => <><Circle cx="11" cy="11" r="7" stroke={c} /><Line x1="21" y1="21" x2="16.5" y2="16.5" stroke={c} /></>,
  chevron: (c) => <Polyline points="9 6 15 12 9 18" stroke={c} />,
  back: (c) => <Polyline points="15 6 9 12 15 18" stroke={c} />,
  check: (c) => <Polyline points="5 12 10 17 19 7" stroke={c} />,
  close: (c) => <><Line x1="6" y1="6" x2="18" y2="18" stroke={c} /><Line x1="18" y1="6" x2="6" y2="18" stroke={c} /></>,
  shield: (c) => <><Path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" stroke={c} /><Polyline points="9 12 11 14 15 10" stroke={c} /></>,
  pin: (c) => <><Path d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z" stroke={c} /><Circle cx="12" cy="10" r="2.5" stroke={c} /></>,
  phone: (c) => <Path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z" stroke={c} />,
  clock: (c) => <><Circle cx="12" cy="12" r="9" stroke={c} /><Polyline points="12 7 12 12 15 14" stroke={c} /></>,
  star: (c) => <Path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" stroke={c} />,
  filter: (c) => <><Line x1="4" y1="6" x2="20" y2="6" stroke={c} /><Line x1="7" y1="12" x2="17" y2="12" stroke={c} /><Line x1="10" y1="18" x2="14" y2="18" stroke={c} /></>,
  alert: (c) => <><Path d="M12 3l10 18H2z" stroke={c} /><Line x1="12" y1="10" x2="12" y2="15" stroke={c} /><Line x1="12" y1="18" x2="12.01" y2="18" stroke={c} /></>,
  card: (c) => <><Rect x="2" y="5" width="20" height="14" rx="2" stroke={c} /><Line x1="2" y1="10" x2="22" y2="10" stroke={c} /></>,
  logout: (c) => <><Path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" stroke={c} /><Polyline points="16 17 21 12 16 7" stroke={c} /><Line x1="21" y1="12" x2="9" y2="12" stroke={c} /></>,
  users: (c) => <><Circle cx="9" cy="8" r="3.5" stroke={c} /><Path d="M2 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5" stroke={c} /><Path d="M16 4.5a3.5 3.5 0 010 7M18 15c2.5.6 4 2.2 4 5" stroke={c} /></>,
  device: (c) => <><Rect x="7" y="2" width="10" height="20" rx="2" stroke={c} /><Line x1="11" y1="18" x2="13" y2="18" stroke={c} /></>,
  trash: (c) => <><Polyline points="3 6 5 6 21 6" stroke={c} /><Path d="M19 6l-1 14H6L5 6M9 6V3h6v3" stroke={c} /></>,
  calendarPlus: (c) => <><Rect x="3" y="5" width="18" height="16" rx="2" stroke={c} /><Line x1="12" y1="12" x2="12" y2="18" stroke={c} /><Line x1="9" y1="15" x2="15" y2="15" stroke={c} /><Line x1="8" y1="3" x2="8" y2="7" stroke={c} /><Line x1="16" y1="3" x2="16" y2="7" stroke={c} /></>,
  globe: (c) => <><Circle cx="12" cy="12" r="9" stroke={c} /><Path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" stroke={c} /></>,
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 22, color, mirror = false, fill }: { name: IconName; size?: number; color: string; mirror?: boolean; fill?: string }) {
  const { i18n } = useTranslation();
  const flip = mirror && isRtlLang(i18n.language);
  return (
    <View aria-hidden style={flip ? { transform: [{ scaleX: -1 }] } : undefined}>
      <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill ?? "none"} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        {P[name](color)}
      </Svg>
    </View>
  );
}
