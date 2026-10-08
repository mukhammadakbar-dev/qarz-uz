import type { ReactNode } from 'react';

/** Chiziqli SVG ikonkalar: rang `currentColor`, ekran o'quvchidan yashirin (yonidagi matn yoki aria-label ishlaydi). */
function Svg({
  size = 24,
  width = 2,
  children,
}: {
  size?: number;
  width?: number;
  children: ReactNode;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const IconBack = () => (
  <Svg>
    <path d="M15 18l-6-6 6-6" />
  </Svg>
);
export const IconClose = ({ size = 22 }: { size?: number }) => (
  <Svg size={size}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);
export const IconMore = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="5" cy="12" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="19" cy="12" r="1.8" />
  </svg>
);
export const IconSearch = () => (
  <Svg size={20}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </Svg>
);
export const IconPlus = ({ size = 20 }: { size?: number }) => (
  <Svg size={size} width={2.4}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
/** Qarz: pul chiqdi (o'ng-yuqoriga). */
export const IconDebt = ({ size = 18 }: { size?: number }) => (
  <Svg size={size} width={2.2}>
    <path d="M7 17L17 7M9 7h8v8" />
  </Svg>
);
/** To'lov: pul keldi (chap-pastga). */
export const IconPay = ({ size = 18 }: { size?: number }) => (
  <Svg size={size} width={2.2}>
    <path d="M17 7L7 17M15 17H7V9" />
  </Svg>
);
export const IconUndo = ({ size = 18 }: { size?: number }) => (
  <Svg size={size}>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h11a5 5 0 010 10h-3" />
  </Svg>
);
export const IconPhone = () => (
  <Svg size={14}>
    <path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2" />
  </Svg>
);
export const IconChevronDown = () => (
  <Svg size={16}>
    <path d="M6 9l6 6 6-6" />
  </Svg>
);
export const IconBook = () => (
  <Svg>
    <path d="M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3V4z" />
    <path d="M9 9h6M9 13h4" />
  </Svg>
);
export const IconStore = () => (
  <Svg>
    <path d="M4 9l2-5h12l2 5" />
    <path d="M5 9v11h14V9" />
    <path d="M4 9a3 3 0 006 0 3 3 0 006 0 3 3 0 004 0" />
  </Svg>
);
export const IconBackspace = () => (
  <Svg size={26} width={1.8}>
    <path d="M9 5h11v14H9l-6-7 6-7z" />
    <path d="M12.5 9.5l5 5M17.5 9.5l-5 5" />
  </Svg>
);
export const IconCheck = ({ size = 22 }: { size?: number }) => (
  <Svg size={size} width={2.4}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
);
export const IconPencil = () => (
  <Svg size={18}>
    <path d="M4 20h4L19 9l-4-4L4 16v4z" />
    <path d="M13.5 6.5l4 4" />
  </Svg>
);
export const IconShield = () => (
  <Svg>
    <path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z" />
    <path d="M9 12l2 2 4-4" />
  </Svg>
);
export const IconTrash = () => (
  <Svg size={18}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </Svg>
);
