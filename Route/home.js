import express from "express";
import upload from "../config/multer.js";
import { createHome } from "../Controller/homeControllers.js";

const router = express.Router();

router.post("/create", upload.single("image"), createHome);

export default router;
