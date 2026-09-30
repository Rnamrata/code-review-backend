import { Request, Response, NextFunction } from 'express';
import { logger, logRequest } from '../utils/logger.util';
import { FileUploadService } from '../services/fileUpload.service';
import { successResponse, errorResponse } from '../utils/responseFormatter.util'; 
import { HTTP_STATUS } from '../constants/httpStatus';

export const uploadFile = async (
    req: Request,
    res: Response,
    next: NextFunction) => {
    const startTime = Date.now();
    try {
        if(!req.file) {
            res.status(HTTP_STATUS.BAD_REQUEST).json(
                errorResponse('No file provided', 'Please upload a file to proceed')
            );
            return;
        }

        logger.debug('Uploaded request received', {
            filename: req.file.originalname,
            size: req.file.size,
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            hashFile: !!req.file
        });
        const language = req.body.language;

        const result = await FileUploadService.processUpload(req.file, language);
        const duration = Date.now() - startTime;

        logRequest('POST', req.path, HTTP_STATUS.CREATED, duration, {
            sessionID: result.sessionID
        });

        res.status(HTTP_STATUS.CREATED).json(successResponse(
            result,
            'File uploaded successfully'
        ));
    } catch (error) {
        const duration = Date.now() - startTime;

        logRequest('POST', req.path, HTTP_STATUS.INTERNAL_ERROR, duration, {
            error: (error as Error).message
        });

        next(error);
    }
};