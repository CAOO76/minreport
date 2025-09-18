import React from 'react';
import { styled } from '@mui/material/styles';
import Switch from '@mui/material/Switch';
import CheckIcon from '@mui/icons-material/Check';

// Extraemos los props del componente Switch usando TypeScript
type M3SwitchProps = React.ComponentProps<typeof Switch>;

const M3Switch = styled((props: M3SwitchProps) => (
  <Switch 
    focusVisibleClassName=".Mui-focusVisible" 
    disableRipple 
    {...props} 
    checkedIcon={<CheckIcon sx={{ fontSize: 16 }} />}
  />
))(({ theme }) => ({
  width: 52,
  height: 32,
  padding: 0,
  '& .MuiSwitch-switchBase': {
    padding: 0,
    margin: 2,
    transitionDuration: '300ms',
    '&.Mui-checked': {
      transform: 'translateX(20px)',
      color: '#fff',
      '& + .MuiSwitch-track': {
        backgroundColor: theme.palette.mode === 'dark' ? '#6750A4' : '#6750A4',
        opacity: 1,
        border: 0,
      },
      '& .MuiSwitch-thumb': {
        '& .MuiSvgIcon-root': {
          display: 'block',
        },
      },
      '&.Mui-disabled + .MuiSwitch-track': {
        opacity: 0.5,
      },
    },
    '&.Mui-focusVisible .MuiSwitch-thumb': {
      color: '#6750A4',
      border: '6px solid #fff',
    },
    '&.Mui-disabled .MuiSwitch-thumb': {
      color:
        theme.palette.mode === 'light'
          ? theme.palette.grey[100]
          : theme.palette.grey[600],
    },
  },
  '& .MuiSwitch-thumb': {
    boxSizing: 'border-box',
    width: 28,
    height: 28,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    '& .MuiSvgIcon-root': {
      display: 'none',
    },
  },
  '& .MuiSwitch-track': {
    borderRadius: 32 / 2,
    backgroundColor: theme.palette.mode === 'light' ? '#E9E9EA' : '#39393D',
    opacity: 1,
    transition: theme.transitions.create(['background-color'], {
      duration: 500,
    }),
  },
}));

export default M3Switch;