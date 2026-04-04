import { log } from "ding:std";
const name = "Dallas";
const health = 100;
const getStatus = (h) => {
  if (h > 0) {
    return `${name} is alive with ${h} health`;
  }
  return null;
};
const status = getStatus(health);
