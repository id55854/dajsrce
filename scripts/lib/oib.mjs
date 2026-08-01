/** Validate a Croatian personal identification number using ISO 7064 MOD 11,10. */
export function isValidOib(value) {
  if (!/^\d{11}$/.test(value)) return false;
  let remainder = 10;
  for (let index = 0; index < 10; index += 1) {
    remainder = (remainder + Number(value[index])) % 10;
    if (remainder === 0) remainder = 10;
    remainder = (remainder * 2) % 11;
  }
  let check = 11 - remainder;
  if (check === 10) check = 0;
  return check === Number(value[10]);
}
