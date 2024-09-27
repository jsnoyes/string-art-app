// SliderComponent.tsx

import React, { useState } from 'react';

interface SliderProps {
  initialValue?: number;
  onValueChange?: (value: number) => void;
}

const SliderComponent: React.FC<SliderProps> = ({ initialValue = 1, onValueChange }) => {
  const [value, setValue] = useState<number>(initialValue);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseInt(event.target.value, 10);
    setValue(newValue);
    if (onValueChange) {
      onValueChange(newValue);
    }
  };

  return (
    <div>
      <input
        type="range"
        min="1"
        max="10"
        value={value}
        onChange={handleChange}
      />
      <span>{value}</span>
    </div>
  );
};

export default SliderComponent;
