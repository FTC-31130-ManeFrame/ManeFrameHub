import React from 'react';
import { useTeamSettings } from '../contexts/TeamSettingsContext';
import { LION_SHAPES, type LionInk } from '../shared/lionLogo';

const paint = (ink: LionInk) => (ink === 'white' ? 'white' : 'currentColor');

const LionShapes: React.FC = () => (
  <>
    {LION_SHAPES.map((shape, i) => {
      if (shape.kind === 'circle') {
        return <circle key={i} cx={shape.cx} cy={shape.cy} r={shape.r} fill={paint(shape.ink)} />;
      }
      const d = shape.points.map(([x, y]) => `${x},${y}`).join(' L ');
      if (shape.kind === 'polygon') {
        return (
          <path
            key={i}
            d={`M ${d} Z`}
            fill={paint(shape.ink)}
            {...(shape.grow
              ? { stroke: paint(shape.ink), strokeWidth: shape.grow * 2, strokeLinejoin: 'round' as const }
              : {})}
          />
        );
      }
      return (
        <path
          key={i}
          d={`M ${d}`}
          fill="none"
          stroke={paint(shape.ink)}
          strokeWidth={shape.w}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    })}
  </>
);

interface TeamLogoProps {
  className?: string;
  teamNumber?: number;
  logoUrl?: string | null;
}

const TeamLogo: React.FC<TeamLogoProps> = ({ className, teamNumber: teamNumberProp, logoUrl: logoUrlProp }) => {
  const { settings } = useTeamSettings();
  const teamNumber = teamNumberProp ?? settings.teamNumber;
  const logoUrl = logoUrlProp !== undefined ? logoUrlProp : settings.logoUrl;

  if (logoUrl) {
    return <img src={logoUrl} alt="Team logo" className={className} style={{ objectFit: 'contain' }} />;
  }

  return (
    <svg viewBox="0 0 100 100" className={className} xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" rx="10" fill="currentColor" />
      <LionShapes />
      <text x="50" y="91" fontFamily="monospace" fontWeight="900" fontSize="14" fill="white" textAnchor="middle" letterSpacing="-1">{teamNumber}</text>
    </svg>
  );
};

export default TeamLogo;
