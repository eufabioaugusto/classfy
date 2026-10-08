import Svg, { Path, G, Ellipse, Circle } from 'react-native-svg';
export function ClassyAvatar({ size = 32 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      {/* A curious guide: expressive glasses and a balanced, rounded silhouette. */}
      <Path
        d="M33 5C18 5 8 15 8 31v11c0 12 11 18 25 18s25-6 25-18V31C58 15 48 5 33 5Z"
        fill="#30203e"
      />
      <Path
        d="M33 11C22 11 13 19 13 31v11c0 9 9 15 20 15s20-6 20-15V31C53 19 44 11 33 11Z"
        fill="#fff7ef"
      />
      <Path
        d="M9 30C9 14 18 6 33 6s24 8 24 24l-4-3c-9-1-16-7-20-11-3 7-10 12-20 13Z"
        fill="#30203e"
      />
      <Path
        d="M34 10c7 1 12 4 15 9"
        fill="none"
        stroke="#674270"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <Path
        d="M8 33c0-6 4-10 11-10s10 5 14 5 7-5 14-5 11 4 11 10-4 12-11 12-10-7-14-7-7 7-14 7S8 39 8 33Z"
        fill="#ed1651"
      />
      <G>
        <Ellipse cx="20" cy="33" rx="8" ry="8.5" fill="white" />
        <Ellipse cx="46" cy="33" rx="8" ry="8.5" fill="white" />
        <G>
          <Ellipse cx="21" cy="33" rx="4.5" ry="5.5" fill="#30203e" />
          <Ellipse cx="45" cy="33" rx="4.5" ry="5.5" fill="#30203e" />
          <Circle cx="23" cy="30" r="2" fill="white" />
          <Circle cx="47" cy="30" r="2" fill="white" />
        </G>
      </G>
      <Path
        d="M13 27q7-5 13 0M40 27q7-5 13 0"
        fill="none"
        stroke="#ff6990"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <Path
        d="M28 47q5 5 10-1"
        fill="none"
        stroke="#30203e"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </Svg>
  );
}
