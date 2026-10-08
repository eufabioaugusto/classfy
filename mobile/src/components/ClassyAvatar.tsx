import Svg, { Path, G, Ellipse, Circle } from 'react-native-svg';
export function ClassyAvatar({
  size = 32,
  variant = 'color',
  color = '#fff',
}: {
  size?: number;
  variant?: 'color' | 'outline';
  color?: string;
}) {
  if (variant === 'outline')
    return (
      <Svg width={size} height={size} viewBox="0 0 64 64">
        <G
          fill="none"
          stroke={color}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <Path
            d="M8 25C10 12 19 5 33 5s23 8 25 20M8 43c0 11 11 17 25 17s25-6 25-17"
            strokeWidth={3.2}
          />
          <Path
            d="M13 27c9-1 16-7 20-12 4 5 11 10 20 12"
            strokeWidth={3.2}
          />
          <Ellipse cx="20" cy="33" rx="11" ry="11" strokeWidth={3.6} />
          <Ellipse cx="46" cy="33" rx="11" ry="11" strokeWidth={3.6} />
          <Path d="M31 31q2-2 4 0" strokeWidth={3.6} />
          <Path d="M28 49q5 5 10-1" strokeWidth={3.6} />
        </G>
        {/* Pupils and transparent highlights preserve her curious expression. */}
        <Path
          fill={color}
          fillRule="evenodd"
          d="M26.2 33a5.2 6.2 0 1 0-10.4 0a5.2 6.2 0 1 0 10.4 0Z M24.2 30a1.7 1.7 0 1 0-3.4 0a1.7 1.7 0 1 0 3.4 0Z M50.2 33a5.2 6.2 0 1 0-10.4 0a5.2 6.2 0 1 0 10.4 0Z M48.2 30a1.7 1.7 0 1 0-3.4 0a1.7 1.7 0 1 0 3.4 0Z"
        />
      </Svg>
    );
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
